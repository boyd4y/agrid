import { useEffect, useState } from "react";
import { AlertDialog } from "radix-ui";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
};

export function DeleteConfirmation({ open, onOpenChange, title, description, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) setError(null); }, [open]);

  const performDelete = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg">
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="break-words text-sm leading-relaxed text-muted-foreground">
            {description}
          </AlertDialog.Description>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}><X data-icon="inline-start" />取消</Button>
            </AlertDialog.Cancel>
            <Button variant="destructive" disabled={busy} onClick={() => void performDelete()}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
              {busy ? "删除中…" : "确认删除"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
