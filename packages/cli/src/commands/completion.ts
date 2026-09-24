import type { Command } from 'commander';
import pc from 'picocolors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

type Shell = 'bash' | 'zsh' | 'fish';

// ── Helpers ───────────────────────────────────────────────

function detectShell(): Shell {
	const shell = process.env.SHELL?.split('/').pop() || '';
	if (shell === 'zsh') return 'zsh';
	if (shell === 'fish') return 'fish';
	return 'bash';
}

function rcFilePath(shell: Shell): string {
	const home = os.homedir();
	switch (shell) {
		case 'bash':
			// macOS: .bash_profile, Linux: .bashrc
			return fs.existsSync(path.join(home, '.bash_profile')) ? path.join(home, '.bash_profile') : path.join(home, '.bashrc');
		case 'zsh':
			return path.join(home, '.zshrc');
		case 'fish':
			return path.join(home, '.config', 'fish', 'config.fish');
	}
}

function completionTargetPath(shell: Shell): string {
	const home = os.homedir();
	switch (shell) {
		case 'bash':
			return path.join(home, '.headless-completion.bash');
		case 'zsh':
			return path.join(home, '.headless-completion.zsh');
		case 'fish':
			return path.join(home, '.config', 'fish', 'completions', 'headless.fish');
	}
}

// ── Completion Script Templates ───────────────────────────

function bashCompletionScript(): string {
	return `# headless completion for bash
_headless_completion() {
	local IFS=$'\\n'
	local cur="\${COMP_WORDS[COMP_CWORD]}"
	local response

	# Delegate to the CLI's internal completion engine
	response=\$(headless --_complete "$COMP_CWORD" "\${COMP_LINE}" 2>/dev/null)
	if [[ -n "$response" ]]; then
		COMPREPLY=(\$(compgen -W "$response" -- "$cur"))
	else
		COMPREPLY=()
	fi
}
complete -F _headless_completion headless
`;
}

function zshCompletionScript(): string {
	return `#compdef headless

_headless() {
	local line="\${words[*]}"
	local idx=$((CURRENT - 1))
	local -a completions
	completions=("\${(@f)\$(headless --_complete "$idx" "$line" 2>/dev/null)}")
	if (( \${#completions} )); then
		compadd "\${completions[@]}"
	fi
}

# Register for headless command
compdef _headless headless
`;
}

function fishCompletionScript(): string {
	return `# headless completion for fish
function _headless_completion
	# Completed tokens (before the current partial word)
	set -l tokens (commandline -opc)
	set -l idx (count $tokens)

	# Build the full command line
	set -l cur (commandline -ct)
	set -l line (string join ' ' $tokens)
	if test -n "$cur"
		set line "$line $cur"
	end

	headless --_complete $idx "$line" 2>/dev/null
end
complete -c headless -f -a '(_headless_completion)'
`;
}

function completionScript(shell: Shell): string {
	switch (shell) {
		case 'bash':
			return bashCompletionScript();
		case 'zsh':
			return zshCompletionScript();
		case 'fish':
			return fishCompletionScript();
	}
}

// ── Install Completion ────────────────────────────────────

async function installCompletion(shell: Shell): Promise<void> {
	const script = completionScript(shell);
	const targetPath = completionTargetPath(shell);
	const rcPath = rcFilePath(shell);

	// Ensure parent directory exists
	const dir = path.dirname(targetPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	// Write the completion script
	fs.writeFileSync(targetPath, script, { mode: 0o644 });

	const sourceLine =
		shell === 'fish'
			? '' // fish auto-discovers completions in ~/.config/fish/completions/
			: `\n[ -f ${targetPath} ] && source ${targetPath}`;

	console.log(pc.green(`\n✓ Completion script written to ${pc.cyan(targetPath)}`));

	if (sourceLine && rcPath) {
		// Check if the source line already exists in the rc file
		const rcExists = fs.existsSync(rcPath);
		const rcContent = rcExists ? fs.readFileSync(rcPath, 'utf-8') : '';

		if (!rcContent.includes(targetPath)) {
			console.log('');
			console.log(pc.yellow('Add this line to your shell config:'));
			console.log(pc.cyan(`  echo '${sourceLine.trim()}' >> ${rcPath}`));
			console.log('');
			console.log(pc.dim(`  Then run: source ${rcPath}`));
		} else {
			console.log('');
			console.log(pc.dim(`  Already sourced in ${rcPath}`));
			console.log(pc.dim(`  Reload with: source ${rcPath}`));
		}
	} else if (shell === 'fish') {
		console.log(pc.dim('\n  Fish auto-discovers completions. Restart your shell or run:'));
		console.log(pc.cyan('  exec fish'));
	}

	if (shell !== detectShell()) {
		console.log('');
		console.log(pc.yellow(`  Note: Your current shell is ${pc.cyan(detectShell())}, but you installed for ${pc.cyan(shell)}`));
	}

	console.log('');
}

// ── Generate Completion Script ────────────────────────────

async function generateCompletion(shell: Shell): Promise<void> {
	process.stdout.write(completionScript(shell));
}

// ── Dynamic Completion Engine ─────────────────────────────

/**
 * Handles the hidden --_complete flag used by shell completion functions.
 * Outputs one completion candidate per line to stdout.
 *
 * Usage: headless --_complete <word-index> "<command-line>"
 *
 * `wordIndex` is the 0-based index of the word being completed (e.g. bash $COMP_CWORD).
 * `line` is the full command line as typed.
 *
 * Walks Commander's registered command tree to find matching
 * subcommands and options at the cursor position.
 */
export function handleCompletion(wordIndex: number, line: string): void {
	const tokens = parseTokens(line);
	// The partial word being completed (may be empty if cursor is on a new word)
	const partial = wordIndex < tokens.length ? tokens[wordIndex] : '';

	// Walk the command tree to find the current command context
	let cmd: Command | undefined = (globalThis as { __headlessProgram?: Command }).__headlessProgram;
	if (!cmd) {
		outputCompletions([], [], partial);
		return;
	}

	// Traverse tokens up to (but not including) the word being completed
	for (let i = 1; i < wordIndex && i < tokens.length; i++) {
		const token = tokens[i];
		if (token.startsWith('-')) continue; // skip options when traversing

		const sub = findSubcommand(cmd, token);
		if (sub) {
			cmd = sub;
		} else {
			break;
		}
	}

	// Collect completions from the current command context
	const commands: string[] = [];
	const options: string[] = [];

	// Subcommand names
	for (const sub of cmd.commands) {
		const name = sub.name();
		if (name && !name.startsWith('_')) {
			commands.push(name);
		}
	}

	// Long options (--flag)
	for (const opt of cmd.options || []) {
		if (opt.long && !opt.hidden) {
			const flag = `--${opt.long.replace(/^--/, '')}`;
			options.push(flag);
		}
		if (opt.short && !opt.hidden) {
			options.push(`-${opt.short}`);
		}
	}

	outputCompletions(commands, options, partial);
}

function findSubcommand(cmd: Command, name: string): Command | undefined {
	for (const sub of cmd.commands) {
		if (sub.name() === name) return sub;
		// Also check aliases
		if (sub.aliases().includes(name)) return sub;
	}
	return undefined;
}

function parseTokens(line: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];

		if (inSingle) {
			if (ch === "'") {
				inSingle = false;
			} else {
				current += ch;
			}
			continue;
		}
		if (inDouble) {
			if (ch === '"') {
				inDouble = false;
			} else {
				current += ch;
			}
			continue;
		}

		if (ch === "'") {
			inSingle = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			continue;
		}
		if (ch === ' ' || ch === '\t') {
			if (current) {
				tokens.push(current);
				current = '';
			}
			continue;
		}
		current += ch;
	}
	if (current) tokens.push(current);

	return tokens;
}

function outputCompletions(commands: string[], options: string[], partial: string): void {
	const candidates = [...commands, ...options];
	const results = partial ? candidates.filter((c) => c.startsWith(partial)) : candidates;

	for (const r of results) {
		process.stdout.write(r + '\n');
	}
}

// ── Register Command ──────────────────────────────────────

export function registerCompletionCommand(program: Command): void {
	const completion = program.command('completion').description('Shell tab-completion setup');

	completion
		.command('install')
		.description('Install completion for your shell (auto-detect)')
		.option('-s, --shell <shell>', 'Shell type: bash, zsh, fish')
		.action(async (options: { shell?: string }) => {
			const shell = (options.shell || detectShell()) as Shell;
			await installCompletion(shell);
		});

	completion
		.command('generate')
		.description('Generate completion script (pipe to file)')
		.option('-s, --shell <shell>', 'Shell type: bash, zsh, fish', 'bash')
		.action(async (options: { shell?: string }) => {
			await generateCompletion((options.shell || 'bash') as Shell);
		});
}
