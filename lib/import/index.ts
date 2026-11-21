import { createHttpImportClient } from "./http-client";

/** The one import client: the real endpoint through the same-origin bridge, in every mode. */
export const importClient = createHttpImportClient();

export * from "./types";
