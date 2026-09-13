import { Detail } from "../../../components/detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Detail id={(await params).id} />;
}
