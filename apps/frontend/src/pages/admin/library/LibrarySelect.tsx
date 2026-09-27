import { Label, ListBox, Select } from '@heroui/react';

const ALL = 'all';

export interface LibraryOption<T extends string> {
  id: T;
  label: string;
}

/**
 * A labelled HeroUI Select over a fixed list of values. With `allLabel` it gets a first "All"
 * option that stands for no value, which is how the list filters clear themselves.
 */
export function LibrarySelect<T extends string>({
  label,
  value,
  options,
  onChange,
  allLabel,
  className,
}: {
  label: string;
  value: T | undefined;
  options: ReadonlyArray<LibraryOption<T>>;
  onChange: (value: T | undefined) => void;
  allLabel?: string;
  className?: string;
}) {
  const items = allLabel ? [{ id: ALL, label: allLabel }, ...options] : options;

  return (
    <Select
      className={className}
      value={value ?? (allLabel ? ALL : null)}
      onChange={(key) => {
        onChange(options.find((option) => option.id === key)?.id);
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger className="min-h-11 md:min-h-9">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {items.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.label}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
