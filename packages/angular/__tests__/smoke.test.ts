import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect } from "vitest";

@Component({
  selector: "smoke-cmp",
  standalone: true,
  template: `<p>{{ label() }}</p>`,
})
class SmokeComponent {
  readonly label = signal("hello");
}

describe("angular test toolchain", () => {
  it("compiles and renders a standalone component with JIT", () => {
    const fixture = TestBed.createComponent(SmokeComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe("hello");
    fixture.componentInstance.label.set("bye");
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe("bye");
  });
});
