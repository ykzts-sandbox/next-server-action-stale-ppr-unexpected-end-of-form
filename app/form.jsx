"use client";

import { useActionState } from "react";

import { submit } from "./actions";

export function Form() {
  const [state, action, pending] = useActionState(submit, "");
  return (
    <form action={action}>
      <input defaultValue="hello" name="name" />
      <button disabled={pending} type="submit">
        Submit
      </button>
      <output>{state}</output>
    </form>
  );
}
