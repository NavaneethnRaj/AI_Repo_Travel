import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./theme/tokens.css";
import "./app.css";

const app = document.getElementById("app");
if (!app) throw new Error("App container is missing");

createRoot(app).render(<App />);
