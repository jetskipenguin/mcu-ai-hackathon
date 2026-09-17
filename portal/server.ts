import { createApp } from "./app.js";
import { loadEnvironment } from "../countersign/generate/environment.js";

loadEnvironment();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "localhost";
const countersignEnabled = process.env.COUNTERSIGN !== "off";
const app = createApp({ countersignEnabled });

app.listen(port, host, () => {
  console.log(
    `MCU Learning Portal listening on http://${host}:${port} (COUNTERSIGN=${countersignEnabled ? "on" : "off"})`,
  );
});
