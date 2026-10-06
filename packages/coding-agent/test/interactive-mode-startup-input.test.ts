import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => void };
	editor: {
		addToHistory?: (text: string) => void;
		setText: (text: string) => void;
	};
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		isBashRunning: boolean;
		prompt: (text: string, options?: unknown) => Promise<void>;
	};
	flushPendingBashComponents: () => void;
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type InputContext = {
	onInputCallback?: (text: string) => void;
	pendingUserInputs: string[];
};

type StartupSubmitContext = {
	editor: { setText: (text: string) => void };
	showStatus: (message: string) => void;
};

type ClearCommandContext = {
	clearStatusIndicator: () => void;
	runtimeHost: {
		newSession: (options?: {
			setup?: (sessionManager: { appendSessionInfo: (name: string) => void }) => Promise<void>;
		}) => Promise<{ cancelled: boolean }>;
	};
	chatContainer: { addChild: (child: unknown) => void };
	ui: { requestRender: () => void };
	handleFatalRuntimeError: (message: string, error: unknown) => Promise<void>;
};

type InteractiveModePrivate = {
	handleStartupSubmit(this: StartupSubmitContext, text: string): void;
	setupEditorSubmitHandler(this: SubmitContext): void;
	handleClearCommand(this: ClearCommandContext, name?: string): Promise<void>;
	getUserInput(this: InputContext): Promise<string>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createSubmitContext(): SubmitContext {
	return {
		defaultEditor: {},
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
		},
		session: {
			isCompacting: false,
			isStreaming: false,
			isBashRunning: false,
			prompt: vi.fn(async () => {}),
		},
		flushPendingBashComponents: vi.fn(),
		pendingUserInputs: [],
	};
}

describe("InteractiveMode startup input", () => {
	it("restores a prompt submitted while managed-tool setup is running", () => {
		const context: StartupSubmitContext = {
			editor: { setText: vi.fn() },
			showStatus: vi.fn(),
		};

		interactiveModePrototype.handleStartupSubmit.call(context, "early prompt");

		expect(context.editor.setText).toHaveBeenCalledWith("early prompt");
		expect(context.showStatus).toHaveBeenCalledWith("Startup is still in progress");
	});

	it("queues a normal prompt submitted before the input callback is installed", async () => {
		const context = createSubmitContext();
		interactiveModePrototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.(" early prompt ");

		expect(context.pendingUserInputs).toEqual(["early prompt"]);
		expect(context.flushPendingBashComponents).toHaveBeenCalledTimes(1);
		expect(context.editor.addToHistory).toHaveBeenCalledWith("early prompt");
	});

	it("passes a trimmed name from /new <name> to the new-session handler", async () => {
		const context = Object.assign(createSubmitContext(), {
			handleClearCommand: vi.fn(async () => {}),
		});

		interactiveModePrototype.setupEditorSubmitHandler.call(context);
		await context.defaultEditor.onSubmit?.("/new  new-session-name  ");

		expect(context.handleClearCommand).toHaveBeenCalledWith("new-session-name");
		expect(context.editor.setText).toHaveBeenCalledWith("");
	});

	it("names a new session from /new <name>", async () => {
		const appendSessionInfo = vi.fn();
		const newSession = vi.fn(
			async (options?: {
				setup?: (sessionManager: { appendSessionInfo: (name: string) => void }) => Promise<void>;
			}) => {
				await options?.setup?.({ appendSessionInfo });
				return { cancelled: false };
			},
		);
		const context: ClearCommandContext = {
			clearStatusIndicator: vi.fn(),
			runtimeHost: { newSession },
			chatContainer: { addChild: vi.fn() },
			ui: { requestRender: vi.fn() },
			handleFatalRuntimeError: vi.fn(async () => {}),
		};

		// #6726: /new <name> should persist the name while creating the session.
		await interactiveModePrototype.handleClearCommand.call(context, "new-session-name");

		expect(appendSessionInfo).toHaveBeenCalledWith("new-session-name");
	});

	it("returns queued startup input before installing a new input callback", async () => {
		const context: InputContext = {
			pendingUserInputs: ["queued prompt"],
		};

		await expect(interactiveModePrototype.getUserInput.call(context)).resolves.toBe("queued prompt");
		expect(context.onInputCallback).toBeUndefined();
		expect(context.pendingUserInputs).toEqual([]);
	});
});
