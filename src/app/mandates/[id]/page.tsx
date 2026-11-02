import { MandatePage } from "@/components/MandatePage";
import { isSandbox } from "@/lib/paypal";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MandatePage id={id} sandbox={isSandbox()} />;
}
