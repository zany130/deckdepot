import { Dropdown, Field, type DropdownOption, type SingleDropdownOption } from "@decky/ui";
import type { ReactElement, ReactNode } from "react";

const controlStyle = {
  boxSizing: "border-box" as const,
  width: "20rem",
  minWidth: "16rem",
  maxWidth: "100%",
};

export default function SettingsDropdown({
  label,
  description,
  rgOptions,
  selectedOption,
  disabled,
  onChange,
}: {
  label: ReactNode;
  description?: ReactNode;
  rgOptions: DropdownOption[];
  selectedOption: unknown;
  disabled?: boolean;
  onChange: (option: SingleDropdownOption) => void;
}): ReactElement {
  return (
    <Field
      label={label}
      description={description}
      childrenLayout="inline"
      childrenContainerWidth="min"
      inlineWrap="shift-children-below"
      padding="standard"
      bottomSeparator="standard"
      highlightOnFocus
    >
      <div style={controlStyle}>
        <Dropdown
          rgOptions={rgOptions}
          selectedOption={selectedOption}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </Field>
  );
}
