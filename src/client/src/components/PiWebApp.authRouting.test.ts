import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "../controllers/authController";
import { SessionController } from "../controllers/sessionController";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp authentication command routing", () => {
  it.each(["/login", "/login antigravity", "/logout"])("handles %s locally with steer delivery", (text) => {
    const login = vi.spyOn(AuthController.prototype, "openLogin").mockResolvedValue(undefined);
    const logout = vi.spyOn(AuthController.prototype, "openLogout").mockResolvedValue(undefined);
    const send = vi.spyOn(SessionController.prototype, "send").mockResolvedValue(undefined);
    submit(text);
    expect(send).not.toHaveBeenCalled();
    if (text === "/logout") expect(logout).toHaveBeenCalledOnce();
    else expect(login).toHaveBeenCalledWith(text.includes("antigravity") ? "antigravity" : undefined);
  });

  it("preserves steer delivery for ordinary prompts", () => {
    const send = vi.spyOn(SessionController.prototype, "send").mockResolvedValue(undefined);
    submit("continue working");
    expect(send).toHaveBeenCalledWith("continue working", "steer", undefined, undefined, undefined);
  });
});

function submit(text: string): void {
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  const app = new PiWebApp();
  const method: unknown = Reflect.get(app, "sendPrompt");
  if (typeof method !== "function") throw new Error("Missing sendPrompt");
  Reflect.apply(method, app, [text, "steer"]);
}
