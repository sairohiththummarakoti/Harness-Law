import { env } from 'cloudflare:workers';
import { getAppUser } from '@/app/auth';
import { database } from '@/lib/api';
import { createDriveRepository } from './repository';
import type { DriveDependencies } from './service';

export function driveDependencies(): DriveDependencies {
  return {
    env: env as unknown as Record<string, unknown>,
    repository: createDriveRepository(database()),
    getUser: getAppUser,
    development: process.env.NODE_ENV === 'development',
  };
}
