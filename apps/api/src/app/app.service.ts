import { Injectable } from '@nestjs/common';
import { Building, CreateBuildingDto, createBuilding } from '@org/shared';

import { PrismaService } from '../prisma/prisma.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  db: 'up' | 'down';
}

const DB_PING_TIMEOUT_MS = 2_000;

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  createBuilding(id: string, dto: CreateBuildingDto): Building {
    return createBuilding(id, dto);
  }

  /**
   * Liveness/readiness probe. Always answers 200 from the controller; only
   * `status` degrades when the database is unreachable.
   */
  async checkHealth(): Promise<HealthReport> {
    const db = await this.pingDb();
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? 'dev',
      db,
    };
  }

  /** SELECT 1 with a hard timeout; any failure counts as down. */
  private pingDb(): Promise<'up' | 'down'> {
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve('down'),
        DB_PING_TIMEOUT_MS,
      );
      this.prisma
        .$queryRaw`SELECT 1`
        .then(() => resolve('up'))
        .catch(() => resolve('down'))
        .finally(() => clearTimeout(timer));
    });
  }
}
