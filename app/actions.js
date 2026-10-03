"use server";

export async function submit(_previousState, formData) {
  return `Received ${formData.get("name")}`;
}
