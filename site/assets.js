/**
 * Where the page's data comes from, the two addresses the published site reads differently from the dev server.
 *
 * The dev server answers the raw route from a disk copy of every client file it has fetched, so a batch over
 * hundreds of skies downloads each file once, and it serves each build's light tables as they were exported. The
 * published site is written with wago.tools' CASC route in place of the first, which a page can reach directly
 * because it answers with `access-control-allow-origin: *`, and with the gzipped tables in place of the second.
 */

/** A client file (an M2, a skin, a BLP), as a template over `{build}` and `{fid}`. */
export const RAW_URL = "https://wago.tools/api/casc/{fid}?version={build}";

/** A build's light tables, as a template over `{build}`; an address ending in `.gz` is unpacked as it arrives. */
export const TABLES_URL = "./data/versions/{build}/light.json.gz";
