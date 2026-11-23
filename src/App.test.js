import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

test("renders board header", () => {
  render(<App />);
  expect(screen.getByText(/My Focus Board/i)).toBeInTheDocument();
  expect(screen.getAllByText("ここにタスクをドラッグまたは追加してください")).toHaveLength(4);
});

test("edits priority label and description by double click", () => {
  render(<App />);

  fireEvent.doubleClick(screen.getAllByText("今日やる")[1]);
  const labelInput = screen.getByDisplayValue("今日やる");
  fireEvent.change(labelInput, { target: { value: "最優先" } });
  fireEvent.keyDown(labelInput, { key: "Enter" });
  expect(screen.getAllByText("最優先")).toHaveLength(2);

  fireEvent.doubleClick(screen.getByText("今日中に片付けたいタスク"));
  const descriptionInput = screen.getByDisplayValue("今日中に片付けたいタスク");
  fireEvent.change(descriptionInput, { target: { value: "今日の最重要タスク" } });
  fireEvent.keyDown(descriptionInput, { key: "Enter" });
  expect(screen.getByText("今日の最重要タスク")).toBeInTheDocument();
});

test("renames and drag-reorders project tags", () => {
  render(<App />);

  const addInput = screen.getByPlaceholderText("案件名を追加");
  fireEvent.change(addInput, { target: { value: "案件A" } });
  fireEvent.click(screen.getByRole("button", { name: "追加" }));
  fireEvent.change(addInput, { target: { value: "案件B" } });
  fireEvent.click(screen.getByRole("button", { name: "追加" }));

  const projectAGroup = screen.getByText("案件A").closest(".project-chip-group");
  const projectBGroup = screen.getByText("案件B").closest(".project-chip-group");
  const dataTransfer = {
    effectAllowed: "move",
    dropEffect: "move",
    setData: jest.fn(),
    getData: jest.fn(() => "案件B")
  };
  fireEvent.dragStart(projectBGroup, { dataTransfer });
  fireEvent.dragOver(projectAGroup, { dataTransfer });
  fireEvent.drop(projectAGroup, { dataTransfer });

  const projectButtons = screen
    .getAllByTitle("ダブルクリックで編集")
    .filter(button => button.classList.contains("project-chip"));
  expect(projectButtons[0]).toHaveTextContent("案件B");
  expect(projectButtons[1]).toHaveTextContent("案件A");

  const projectAButton = screen
    .getAllByTitle("ダブルクリックで編集")
    .find(button => button.textContent.includes("案件A"));
  fireEvent.doubleClick(projectAButton);
  const projectInput = screen.getByDisplayValue("案件A");
  fireEvent.change(projectInput, { target: { value: "案件C" } });
  fireEvent.keyDown(projectInput, { key: "Enter" });
  expect(screen.getByText("案件C")).toBeInTheDocument();
});
