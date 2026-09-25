"""Review of a recorded asset: an admin approves or rejects it only from the status the decision
needs, and every accepted decision leaves one audit row. The SQL itself is checked against a real
PostgreSQL in test_asset_review_postgres.py."""

from uuid import UUID, uuid4

import pytest

from .conftest import ADMIN_PHONE

STATUSES = ["DRAFT", "AUDIO_GENERATED", "AUDIO_APPROVED", "VIDEO_GENERATED", "VIDEO_APPROVED", "REJECTED"]

# The status each decision needs, written out from the contract, not read from the code.
NEEDS = {
    ("video", "VIDEO_APPROVED"): {"VIDEO_GENERATED"},
    ("video", "REJECTED"): {"VIDEO_GENERATED", "VIDEO_APPROVED"},
    ("audio", "AUDIO_APPROVED"): {"AUDIO_GENERATED"},
    ("audio", "REJECTED"): {"AUDIO_GENERATED", "AUDIO_APPROVED"},
}

ACCEPTED = [
    (kind, decision, current) for (kind, decision), needs in NEEDS.items() for current in sorted(needs)
]
REFUSED = [
    (kind, decision, current)
    for (kind, decision), needs in NEEDS.items()
    for current in STATUSES
    if current not in needs
]


def _ids(cases):
    return [f"{kind}-{decision}-from-{current}" for kind, decision, current in cases]


def _add_asset(api, kind: str, status: str) -> UUID:
    asset_id = uuid4()
    rows = api.database.audio_assets if kind == "audio" else api.database.video_assets
    rows[asset_id] = {"id": asset_id, "status": status, "text": "متن خصوصی یک پاسخ"}
    return asset_id


async def _admin_id(api) -> UUID:
    await api.login(ADMIN_PHONE)
    return (await api.database.get_user_by_phone(ADMIN_PHONE))["id"]


async def _review(api, kind: str, asset_id: UUID, decision: str):
    return await api.client.patch(f"/assets/{kind}/{asset_id}/status", json={"status": decision})


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "decision", "current"), ACCEPTED, ids=_ids(ACCEPTED))
async def test_a_decision_from_the_status_it_needs_is_saved_and_audited(api, kind, decision, current):
    admin_id = await _admin_id(api)
    asset_id = _add_asset(api, kind, current)

    response = await _review(api, kind, asset_id, decision)

    assert response.status_code == 200
    assert response.json() == {"id": str(asset_id), "status": decision}
    rows = api.database.audio_assets if kind == "audio" else api.database.video_assets
    assert rows[asset_id]["status"] == decision
    assert api.database.asset_reviews == [
        {
            "asset_kind": kind,
            "asset_id": asset_id,
            "reviewer_user_id": admin_id,
            "decision": decision,
            "previous_status": current,
        }
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "decision", "current"), REFUSED, ids=_ids(REFUSED))
async def test_a_decision_from_any_other_status_is_refused_and_changes_nothing(api, kind, decision, current):
    await _admin_id(api)
    asset_id = _add_asset(api, kind, current)

    response = await _review(api, kind, asset_id, decision)

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "invalid_status_transition"
    assert error["details"] == {"currentStatus": current}
    rows = api.database.audio_assets if kind == "audio" else api.database.video_assets
    assert rows[asset_id]["status"] == current
    assert api.database.asset_reviews == []


@pytest.mark.asyncio
async def test_a_video_that_is_still_recording_cannot_be_approved(api):
    await _admin_id(api)
    asset_id = _add_asset(api, "video", "DRAFT")

    response = await _review(api, "video", asset_id, "VIDEO_APPROVED")

    assert response.status_code == 409
    assert api.database.video_assets[asset_id]["status"] == "DRAFT"
    assert api.database.asset_reviews == []


@pytest.mark.asyncio
async def test_approving_twice_is_refused_the_second_time(api):
    await _admin_id(api)
    asset_id = _add_asset(api, "video", "VIDEO_GENERATED")

    first = await _review(api, "video", asset_id, "VIDEO_APPROVED")
    second = await _review(api, "video", asset_id, "VIDEO_APPROVED")

    assert first.status_code == 200
    assert second.status_code == 409
    assert len(api.database.asset_reviews) == 1


@pytest.mark.asyncio
async def test_an_approval_can_be_withdrawn_but_a_rejection_is_final(api):
    await _admin_id(api)
    asset_id = _add_asset(api, "video", "VIDEO_GENERATED")

    approved = await _review(api, "video", asset_id, "VIDEO_APPROVED")
    rejected = await _review(api, "video", asset_id, "REJECTED")
    approved_again = await _review(api, "video", asset_id, "VIDEO_APPROVED")

    assert [approved.status_code, rejected.status_code, approved_again.status_code] == [200, 200, 409]
    assert [(row["previous_status"], row["decision"]) for row in api.database.asset_reviews] == [
        ("VIDEO_GENERATED", "VIDEO_APPROVED"),
        ("VIDEO_APPROVED", "REJECTED"),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["audio", "video"])
async def test_an_unknown_asset_is_not_found_and_not_audited(api, kind):
    await _admin_id(api)
    decision = "AUDIO_APPROVED" if kind == "audio" else "VIDEO_APPROVED"

    response = await _review(api, kind, uuid4(), decision)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert api.database.asset_reviews == []


@pytest.mark.asyncio
@pytest.mark.parametrize(("kind", "decision"), [("audio", "VIDEO_APPROVED"), ("video", "AUDIO_APPROVED")])
async def test_a_status_of_the_other_kind_is_still_a_validation_error(api, kind, decision):
    await _admin_id(api)
    current = "AUDIO_GENERATED" if kind == "audio" else "VIDEO_GENERATED"
    asset_id = _add_asset(api, kind, current)

    response = await _review(api, kind, asset_id, decision)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert api.database.asset_reviews == []


@pytest.mark.asyncio
async def test_a_refused_reviewer_leaves_no_audit_row(api):
    await api.login("09123456789")
    asset_id = _add_asset(api, "video", "VIDEO_GENERATED")

    response = await _review(api, "video", asset_id, "VIDEO_APPROVED")

    assert response.status_code == 403
    assert api.database.video_assets[asset_id]["status"] == "VIDEO_GENERATED"
    assert api.database.asset_reviews == []
