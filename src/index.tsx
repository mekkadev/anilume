/* @refresh reload */
import { render } from "solid-js/web";

import { App } from "./App";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/components.css";
import "./styles/player.css";

const root = document.getElementById("root");
if (!root) throw new Error("Не найден корневой элемент");

render(() => <App />, root);
