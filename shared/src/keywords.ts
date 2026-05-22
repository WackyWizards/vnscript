export interface KeywordInfo {
  description: string;
  signature?: string;
  example?: string;
  returns?: string;
  category?: 'flow' | 'audio' | 'ui' | 'math' | 'logic' | 'variable';
  minArgs?: number;
  maxArgs?: number;
  expressionArgs?: boolean;
  subkeywords?: string[];
}

export const Keywords: Record<string, KeywordInfo> = {
  label: {
    description: 'Defines a named section of the script.',
    category: 'flow',
  },
  dialogue: {
    description: 'Displays a line of text in the dialogue box.',
    category: 'ui',
    minArgs: 1,
    maxArgs: Infinity,
    subkeywords: ['speaker'],
  },
  choice: {
    description:
      'Generates a clickable button with the provided text and label to jump to.',
    category: 'ui',
    minArgs: 2,
    maxArgs: Infinity,
    subkeywords: ['jump', 'cond'],
  },
  jump: {
    description:
      'Jumps execution to the specified label within the current script.',
    category: 'flow',
    minArgs: 1,
    maxArgs: 1,
  },
  after: {
    description:
      'Specifies one or more actions to run after the label has finished.',
    category: 'flow',
    subkeywords: ['jump', 'end', 'load'],
  },
  speaker: {
    description:
      'When added to a dialogue, defines which character is shown as the speaker.',
    category: 'ui',
  },
  sound: {
    description: 'Plays the specified sound event by name.',
    category: 'audio',
    subkeywords: ['mixer'],
  },
  mixer: {
    description: 'Specifies the target mixer for the sound being played.',
    category: 'audio',
  },
  music: {
    description: 'Plays the specified sound event as background music.',
    category: 'audio',
  },
  bg: {
    description: 'Loads an image asset as the background for this label.',
    category: 'ui',
  },
  input: {
    description: 'Displays an input box for the player to type into.',
    category: 'ui',
  },
  char: {
    description: 'Defines a character to display for this label.',
    category: 'ui',
    subkeywords: ['exp', 'pos', 'rot'],
  },
  exp: {
    description: 'Sets the expression that a character will display.',
    category: 'ui',
  },
  pos: {
    description: 'Sets the position of the character sprite on the screen.',
    category: 'ui',
  },
  rot: {
    description: 'Sets the rotation of the character sprite in degrees.',
    category: 'ui',
  },
  cond: {
    description: 'Gates execution on a condition. Only proceeds if truthy.',
    category: 'logic',
  },
  set: {
    description: 'Sets a variable to the provided value.',
    category: 'variable',
  },
  defun: {
    description: 'Defines a named function with parameters and a body.',
    category: 'variable',
  },
  pow: {
    description:
      'Returns the first value raised to the power of the second value.',
    returns: 'number',
    category: 'math',
    minArgs: 2,
    maxArgs: 2,
    expressionArgs: true,
  },
  sqrt: {
    description: 'Returns the square root of the provided number value.',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    expressionArgs: true,
  },
  body: {
    description:
      'Evaluates multiple expressions in sequence and returns the last value.',
    category: 'flow',
  },
  load: {
    description: 'Loads and switches to a script at the given file path.',
    category: 'flow',
  },
  start: {
    description: 'Specifies which label the script begins execution at.',
    category: 'flow',
  },
  end: {
    description: 'Concludes the script.',
    category: 'flow',
  },
  true: {
    description: 'Boolean literal representing a true value.',
    category: 'logic',
  },
  false: {
    description: 'Boolean literal representing a false value.',
    category: 'logic',
  },
  if: {
    description:
      "Evaluates a condition; runs 'then' branch if truthy, otherwise optional 'else'.",
    category: 'logic',
  },
  when: {
    description:
      'If condition is truthy, executes remaining expressions in sequence.',
    category: 'logic',
  },
  and: {
    description:
      'Returns true only if all conditions are truthy. Short-circuits on first falsy.',
    category: 'logic',
  },
  or: {
    description:
      'Returns true if any condition is truthy. Short-circuits on first truthy.',
    category: 'logic',
  },
  not: {
    description: 'Inverts a boolean value.',
    category: 'logic',
  },
  xor: {
    description: 'Returns true if exactly one condition is truthy.',
    category: 'logic',
  },
  nand: {
    description: 'Returns true if not all conditions are truthy.',
    category: 'logic',
  },
  nor: {
    description: 'Returns true if no conditions are truthy.',
    category: 'logic',
  },
  mod: {
    description: 'Returns the remainder of the division of two numbers.',
    category: 'math',
    minArgs: 2,
    maxArgs: 2,
    expressionArgs: true,
  },
  min: {
    description: 'Returns the smallest of the provided numbers.',
    category: 'math',
    minArgs: 2,
    maxArgs: Infinity,
    expressionArgs: true,
  },
  max: {
    description: 'Returns the largest of the provided numbers.',
    category: 'math',
    minArgs: 2,
    maxArgs: Infinity,
    expressionArgs: true,
  },
};
