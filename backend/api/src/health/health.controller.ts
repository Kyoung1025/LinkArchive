import { Controller, Get } from '@nestjs/common';
import { HealthCheckError, HealthCheckService, HealthCheck, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

async function pingCheck(key: string, check: () => Promise<unknown>): Promise<HealthIndicatorResult> {
  try {
    await check();
    return { [key]: { status: 'up' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new HealthCheckError(`${key} check failed`, { [key]: { status: 'down', message } });
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => pingCheck('database', () => this.prisma.$queryRaw`SELECT 1`),
      () => pingCheck('redis', () => this.redis.ping()),
    ]);
  }
}
