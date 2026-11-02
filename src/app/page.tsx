import { MODEL_LABEL } from "@/lib/model";
import { Home } from "@/components/Home";
import { channel3Enabled } from "@/lib/channel3";
import { isSandbox } from "@/lib/paypal";

export default function Page() {
  return <Home sandbox={isSandbox()} liveCatalog={channel3Enabled()} modelLabel={MODEL_LABEL} />;
}
