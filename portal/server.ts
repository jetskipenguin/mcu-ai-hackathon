import { createApp } from "./app.js";
import { loadEnvironment } from "../countersign/generate/environment.js";

loadEnvironment();

const port = Number(process.env.PORT ?? 3000);
const countersignEnabled = process.env.COUNTERSIGN !== "off";
const app = createApp({ countersignEnabled });

app.listen(port, "localhost", () => {
  console.log(
    `MCU Learning Portal listening on http://localhost:${port} (COUNTERSIGN=${countersignEnabled ? "on" : "off"})`,
  );
});
