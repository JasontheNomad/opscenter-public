import { redirect } from '@sveltejs/kit';
import { authStartUrl } from '$lib/server/teams';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = () => redirect(302, authStartUrl());
