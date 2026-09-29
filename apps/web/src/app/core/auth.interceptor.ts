import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Requests to auth endpoints must not be intercepted (no retry / redirect). */
function isAuthRequest(url: string): boolean {
  return url.startsWith(`${environment.apiUrl}/auth/`);
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const withToken = (r: HttpRequest<unknown>): HttpRequest<unknown> => {
    const token = auth.accessToken;
    if (!token || !r.url.startsWith(environment.apiUrl)) return r;
    return r.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  };

  if (isAuthRequest(req.url)) {
    return next(withToken(req));
  }

  return next(withToken(req)).pipe(
    catchError((err: unknown) => {
      if (
        !(err instanceof HttpErrorResponse) ||
        err.status !== 401 ||
        !auth.currentUser()
      ) {
        return throwError(() => err);
      }
      return auth.refreshAccessToken().pipe(
        switchMap(() => next(withToken(req))),
        catchError(() => {
          auth.logout();
          router.navigateByUrl('/login');
          return throwError(() => err);
        }),
      );
    }),
  );
};
