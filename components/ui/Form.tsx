import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

/** Label + control + hint/error. The control gets the id via the render prop so label and input stay linked. */
export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">{label}</label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
      {error && <p id={`${id}-err`} className="field-error">{error}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input${props.className ? ` ${props.className}` : ""}`} />;
}

export function DateInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <TextInput {...props} type="date" />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input${props.className ? ` ${props.className}` : ""}`} />;
}

/** On/off switch. Renders a checkbox with role="switch" so it also works inside plain HTML forms. */
export function Toggle({ label, name, defaultChecked }: { label: string; name?: string; defaultChecked?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
