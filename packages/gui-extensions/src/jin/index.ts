import { Extension } from "../sdk"
import en from "./i18n/en"

/**
 * Jin's desktop surface.
 *
 * The extension owns a pinned side-panel tab and command. The panel reads the
 * server plugin's RPC state for review and graph data; it never writes the
 * architecture itself.
 */
export default Extension.define({
  id: "jin",
  i18n: {
    en,
    zh: () => import("./i18n/zh"),
  },
})
