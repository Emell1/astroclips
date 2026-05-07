import { Route, Switch } from "wouter"
import UploadPage from "./pages/UploadPage"
import JobPage from "./pages/JobPage"
import ClipEditorPage from "./pages/ClipEditorPage"

export default function App() {
  return (
    <div className="min-h-screen" style={{ background: "#0a0a0f" }}>
      <Switch>
        <Route path="/" component={UploadPage} />
        <Route path="/job/:id" component={JobPage} />
        <Route path="/job/:id/clip/:index" component={ClipEditorPage} />
      </Switch>
    </div>
  )
}
