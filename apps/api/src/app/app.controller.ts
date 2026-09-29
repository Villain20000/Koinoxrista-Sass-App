import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  /**
   * Public liveness probe — intentionally unguarded (same pattern as the PSP
   * webhook controller). Never throws: degraded DB still answers HTTP 200.
   */
  @Get('health')
  health() {
    return this.appService.checkHealth();
  }
}
