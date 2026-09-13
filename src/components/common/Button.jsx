import React from "react";
export default function Button({
  children,
  primary,
  danger,
  onClick,
  disabled = false,
}) {
  return (
    <button
      className={
        "btn " + (primary ? "primary " : "") + (danger ? "danger" : "")
      }
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
