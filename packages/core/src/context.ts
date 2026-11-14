import type { Repositories } from '@cloudsentry/database';
import type { Clock, Logger } from '@cloudsentry/utilities';

/** Dependencies shared by every application service. */
export interface ServiceContext {
  repos: Repositories;
  logger: Logger;
  clock: Clock;
}
