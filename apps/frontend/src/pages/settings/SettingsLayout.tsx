import { Outlet } from 'react-router-dom';

/**
 * Shell for `/settings` and its sub-routes (requirement 5, 15).
 *
 * Requirement 6 removed the shared app header, so each child page draws its
 * own `ScreenHeader` instead of one header living here. This layout only
 * centers the content column: the app shell's own `<main>` already scrolls
 * and already carries `dock-clear` bottom padding so content clears the
 * floating tab bar, so repeating that padding here would just double it.
 */
export function SettingsLayout() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <Outlet />
    </div>
  );
}
