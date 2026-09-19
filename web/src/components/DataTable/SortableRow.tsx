import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { GripIcon } from "../Icons";

// A row that can be dragged by the handle in its leading cell. The cells
// are passed in so the row keeps the same markup as an ordinary one.
export function SortableRow({
  id,
  label,
  className,
  rowProps,
  children,
}: {
  id: string;
  // The handle's accessible name, e.g. "Reorder #general".
  label: string;
  className: string;
  rowProps?: Record<string, string>;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <tr
      ref={setNodeRef}
      className={`${className} ${isDragging ? "dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...rowProps}
    >
      <td className="dt-drag">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="icon-button dt-grip"
          aria-label={label}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
      </td>
      {children}
    </tr>
  );
}
