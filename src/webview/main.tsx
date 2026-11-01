import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { RequestDraft, ResponseResult } from "../model";
import type {
  EnvironmentState,
  HostMessage,
  ViewState,
} from "../shared/messages";
import { post } from "./api";
import { EnvironmentsView } from "./EnvironmentsView";
import { OverviewView } from "./OverviewView";
import { RequestView } from "./RequestView";
import "./styles.css";

function App() {
  const [view, setView] = useState<ViewState>();
  const [env, setEnv] = useState<EnvironmentState>({ names: [] });
  const [draft, setDraft] = useState<RequestDraft>();
  const [response, setResponse] = useState<ResponseResult>();
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      switch (message.type) {
        case "init":
          setView(message.view);
          setEnv(message.env);
          if (message.view.kind === "request") {
            setDraft(message.view.draft);
            setSaved(message.view.saved);
          }
          break;
        case "env":
          setEnv(message.env);
          break;
        case "sending":
          setSending(true);
          break;
        case "response":
          setSending(false);
          setResponse(message.response);
          break;
        case "savedState":
          setSaved(message.saved);
          break;
        case "draft":
          setDraft(message.draft);
          break;
      }
    };
    window.addEventListener("message", listener);
    post({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  if (view?.kind === "overview") {
    return <OverviewView project={view.project} />;
  }
  if (view?.kind === "environments") {
    return (
      <EnvironmentsView
        initial={view.environments}
        active={env.active}
        projectName={view.projectName}
      />
    );
  }
  if (view?.kind === "request" && draft) {
    return (
      <RequestView
        view={view}
        env={env}
        draft={draft}
        setDraft={setDraft}
        response={response}
        sending={sending}
        saved={saved}
      />
    );
  }
  return <div class="loading">Loading…</div>;
}

render(<App />, document.getElementById("root")!);
