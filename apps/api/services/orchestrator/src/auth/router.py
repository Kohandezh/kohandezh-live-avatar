import logging

from fastapi import APIRouter, Depends, Request, Response

from ..errors import NotFoundError
from ..schemas import (
    LoginResponse,
    OtpRequestBody,
    OtpRequestResponse,
    OtpVerifyBody,
    PublicUser,
    UpdateProfileBody,
)
from .dependencies import UserRow, client_ip, get_current_user, session_token
from .phone import mask_phone, normalize_phone
from .sessions import clear_session_cookie, set_session_cookie
from .users import login_user, public_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])


# exclude_none keeps devCode out of the body outside development, instead of sending it as null.
@router.post(
    "/auth/otp/request",
    response_model=OtpRequestResponse,
    response_model_exclude_none=True,
    status_code=202,
)
async def request_otp(payload: OtpRequestBody, request: Request) -> OtpRequestResponse:
    phone = normalize_phone(payload.phone)
    challenge = await request.app.state.otp.request(phone, client_ip(request))
    return OtpRequestResponse(
        phone=phone,
        expires_in_seconds=challenge.expires_in_seconds,
        resend_after_seconds=challenge.resend_after_seconds,
        dev_code=challenge.dev_code,
    )


# exclude_unset leaves accessToken out of the web answer. email stays, because it was set from
# the database row even when it is null.
@router.post("/auth/otp/verify", response_model=LoginResponse, response_model_exclude_unset=True)
async def verify_otp(payload: OtpVerifyBody, request: Request, response: Response) -> LoginResponse:
    settings = request.app.state.settings
    phone = normalize_phone(payload.phone)
    await request.app.state.otp.verify(phone, payload.code)
    user = await login_user(request.app.state.database, settings, phone)
    token = await request.app.state.sessions.issue(user["id"])
    logger.info("login_succeeded", extra={"phone": mask_phone(phone), "role": user["role"]})
    # Native has no cookie jar we control, so it gets the token in the body and stores it in
    # OS-backed secure storage. Web never sees the token in JavaScript.
    if request.headers.get("X-Client-Platform", "web").strip().lower() == "native":
        return LoginResponse(user=public_user(user), access_token=token)
    set_session_cookie(response, token, settings)
    return LoginResponse(user=public_user(user))


@router.post("/auth/logout", status_code=204, response_class=Response)
async def logout(request: Request) -> Response:
    token = session_token(request)
    if token:
        await request.app.state.sessions.revoke(token)
    result = Response(status_code=204)
    clear_session_cookie(result, request.app.state.settings)
    return result


@router.get("/me", response_model=PublicUser)
async def me(user: UserRow = Depends(get_current_user)) -> PublicUser:
    return public_user(user)


# Full replace, not a partial patch: both names are required on every call. An empty
# firstName is how the frontend tells a fresh account from one that finished onboarding, so
# there is no partial-update path that could leave a name half set.
@router.put("/me/profile", response_model=PublicUser)
async def update_me_profile(
    payload: UpdateProfileBody, request: Request, user: UserRow = Depends(get_current_user)
) -> PublicUser:
    updated = await request.app.state.database.update_user_profile(
        user["id"], first_name=payload.first_name, last_name=payload.last_name
    )
    if not updated:
        raise NotFoundError("user")
    return public_user(updated)
