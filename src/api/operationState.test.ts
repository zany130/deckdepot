import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appmanUpdateAllSuccess, viewFromTask } from "./operationState";
import type { TaskProgress } from "../types/flatpak";

describe("appman update all result", () => {
  it("does not claim every checked app was updated", () => {
    assert.equal(
      appmanUpdateAllSuccess({ known: true, changed: [] }, 12),
      "No AppMan apps needed an update"
    );
    assert.equal(
      appmanUpdateAllSuccess(
        {
          known: true,
          changed: [
            { appId: "rpcs3", previousVersion: "v1", currentVersion: "v2" },
          ],
        },
        12
      ),
      "Updated rpcs3"
    );
    assert.equal(
      appmanUpdateAllSuccess(undefined, 12),
      "AppMan checked 12 apps"
    );
  });

  it("uses the report on a completed task", () => {
    const task: TaskProgress = {
      taskId: "t1",
      provider: "appman",
      appId: "all-appman-apps",
      operation: "update_all",
      phase: "completed",
      progressKind: "indeterminate",
      updateReport: { known: true, changed: [] },
    };
    const view = viewFromTask(task, "all-appman-apps", 4);
    assert.equal(view.toast, "No AppMan apps needed an update");
    assert.equal(view.label, "No AppMan apps needed an update");
  });
});
