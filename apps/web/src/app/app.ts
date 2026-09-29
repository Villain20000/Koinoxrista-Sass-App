import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastsComponent } from './ui/toasts.component';

@Component({
  imports: [RouterOutlet, ToastsComponent],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><app-toasts />`,
})
export class App {}
