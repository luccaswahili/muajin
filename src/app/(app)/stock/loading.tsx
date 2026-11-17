import { ListPageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <ListPageSkeleton stats={2} statCols="grid-cols-1 sm:grid-cols-2" rows={6} />;
}
