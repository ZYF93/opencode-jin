import { JinRpc } from "@jin/opencode/rpc"
import { onCleanup } from "solid-js"
import { Command, createKeyed, Panel, type PanelTab, type Setup } from "../sdk"
import type Jin from "./index"
import { JinPanel } from "./panel"

const TAB = "architecture"

const KEY = `jin:${TAB}`

const setup: Setup<typeof Jin> = (ctx) => {
  const tab: PanelTab = {
    id: TAB,
    get title() {
      return ctx.t("panel.title")
    },
    pinned: true,
    fallback: false,
  }

  ctx.add(Panel, {
    id: "architecture",
    region: "side",
    wide: true,
    list: (input) => (input.session.project ? [tab] : []),
    render: (props) => <JinPanel session={props.session} />,
  })

  ctx.add(Command, {
    id: "open",
    title: ctx.t("command.open"),
    group: ctx.t("command.group"),
    get enabled() {
      return !!ctx.sessions.current()
    },
    run: () => {
      const session = ctx.sessions.current()

      if (!session) return

      ctx.layout.open(KEY, session)
    },
  })

  createKeyed(
    () => {
      const session = ctx.sessions.current()

      return session ? { key: session.key, client: session.server.client } : undefined
    },
    (current) => {
      const stop = current.client.rpc(JinRpc.Definition).events.on(
        "approval",
        (event) => {
          const session = ctx.sessions.current()

          if (!session || session.key !== current.key || event.data.sessionID !== session.id) return

          ctx.layout.open(KEY, session)
        },
        { signal: ctx.signal },
      )

      onCleanup(stop)
    },
    { equals: (previous, next) => previous.key === next.key && previous.client === next.client },
  )
}

export default setup
