/**
 * IDP module manifest — the factory's operate + govern surface.
 *
 * Declares the module to the factory core: its routes, and (for future modules)
 * its compiled hooks / roles / identity. Adding a new vertical follows this same
 * shape — a `manifest.ts` beside its `routes.ts`.
 */
import type { Hono } from 'hono';
import type { ModuleManifest } from '@mmbix/types';
import { idpRoutes } from './routes';

export const idpManifest: ModuleManifest = {
	id: 'idp',
	name: 'Internal Developer Platform',
	version: '1.0.0',
	path: '/api/idp',
	routes: idpRoutes as unknown as Hono,
};
