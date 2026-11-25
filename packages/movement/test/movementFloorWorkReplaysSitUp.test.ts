// The sit-up (ROADMAP 52c-ii) under every held replay: test/helpers/floorWorkReplays.ts says what it proves. A proof file.
import { readMovement } from "../scripts/movementCheck.js";
import { floorWorkReplays } from "./helpers/floorWorkReplays.js";

floorWorkReplays(readMovement("sit-up"));
