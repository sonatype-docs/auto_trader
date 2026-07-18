// Reusable checkbox picker for matrix combos.
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type MatrixOption = { value: string; label?: string };

export function MatrixGroup({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: MatrixOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };
  const allValues = options.map((o) => o.value);
  const allOn = selected.length === options.length;
  return (
    <div className="space-y-2 rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2"
            onClick={() => onChange(allOn ? [] : allValues)}>{allOn ? "None" : "All"}</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label key={o.value}
              className={`flex items-center gap-2 rounded border px-2 py-1 text-xs cursor-pointer transition-colors
                ${on ? "border-primary bg-primary/10" : "border-border/60 hover:border-border"}`}>
              <Checkbox checked={on} onCheckedChange={() => toggle(o.value)} />
              <span className="font-mono">{o.label ?? o.value}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
