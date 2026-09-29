import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from '@org/shared';
import { AuthService } from './auth.service';

/** Pure helper: the home route for a given role. */
export function homeForRole(role: Role | null | undefined): string {
  if (!role) return '/login';
  switch (role) {
    case 'ADMIN':
    case 'BUILDING_OWNER':
      return '/admin';
    case 'PROVIDER':
      return '/provider';
    case 'ACCOUNTANT':
      return '/accountant';
    case 'PLATFORM_ADMIN':
      return '/admin/billing';
    default:
      return '/balance';
  }
}

/** Restricts a route to the given roles; unauthenticated users go to /login. */
export function canActivateRole(...roles: Role[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const user = auth.currentUser();
    if (!user) {
      return router.createUrlTree(['/login']);
    }
    if (!roles.includes(user.role)) {
      return router.createUrlTree([homeForRole(user.role)]);
    }
    return true;
  };
}

/** Requires any authenticated user (no specific role). */
export const canActivateAuthed: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser();
  if (!user) {
    return router.createUrlTree(['/login']);
  }
  return true;
};

/** Redirects '' and wildcard routes based on the current session role. */
export const homeRedirectGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = auth.currentUser();
  return router.createUrlTree([user ? homeForRole(user.role) : '/login']);
};
