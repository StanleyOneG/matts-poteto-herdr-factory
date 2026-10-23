# Legion

Legion coordinates approved software work and its review. These terms distinguish authority from execution roles.

## Language

**Emperor**:
The human who approves requirements and retains decisions outside delegated authority.
_Avoid_: Supervisor, when the human decision-maker is meant.

**Legatus**:
The principal agent in the Emperor's interactive session, responsible for scoped assignments, coordination and acceptance. The plural is Legati.
_Avoid_: Tribunus, when the coordinating role is meant.

**Tribunus**:
The principal agent in a separate interactive session assigned bounded work by a Legatus. The plural is Tribuni.
_Avoid_: Native child, when this interactive worker is meant.

**Centurio**:
A native subagent used for delegated work such as implementation, exploration or review. The plural is Centuriones.
_Avoid_: Tribunus, when a native subagent is meant.

**Workflow profile**:
The controller chosen for an assignment, retained through its continuation. Matt-controlled work and poteto-controlled work are distinct profiles.

**Task prerequisite**:
An explicit dependency on another local task's accepted result that must be satisfied before launch. The Legatus defines the dependency; readiness is not an instruction to launch.
_Avoid_: Tracker blocker, when local launch readiness is meant.

**Attempt**:
One recorded execution of an assigned task. Ending an unsuccessful attempt neither accepts its result nor establishes that its writer has stopped.
_Avoid_: Task, when only one execution is meant.

**Accepted result**:
An exact task result explicitly accepted by the Legatus after requirements/check verification, independent review and integration into its intended parent task branch. A worker report or an ended attempt is not acceptance.
_Avoid_: Reported result, when acceptance is meant.
