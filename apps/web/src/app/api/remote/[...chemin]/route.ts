import { relayToApi } from "@/server/api-relay";

/**
 * Chemins servis par l'API, relayés quand Next est la seule porte d'entrée
 * (`API_RELAY=1`, hébergement cPanel). Voir `server/api-relay.ts`.
 */
export const GET = relayToApi;
export const HEAD = relayToApi;
export const POST = relayToApi;
export const PUT = relayToApi;
export const PATCH = relayToApi;
export const DELETE = relayToApi;
