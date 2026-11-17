import { ListPageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <ListPageSkeleton stats={3} statCols="grid-cols-3" rows={6} />;
}
