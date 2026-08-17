# AI-Guided Virtual Science Laboratory - Complete System Explanation (Current Implementation, Completed Features, and Remaining Development)

## 1. Project Overview

The AI-Guided Virtual Science Laboratory is an interactive digital learning platform designed for Grade 10 and Grade 11 students based on the Sri Lankan school curriculum.

The purpose of the system is to allow students to perform science experiments in a virtual laboratory environment using a mobile device or web browser instead of relying entirely on a physical laboratory.

However, this system is not designed to be a traditional chemistry simulator.

Most virtual laboratories simply allow students to mix chemicals and observe reactions.

This project introduces an AI-guided learning environment in which an intelligent tutor continuously observes student behavior, analyzes learning patterns, identifies misconceptions, provides adaptive feedback, and evaluates conceptual understanding.

The system combines:

* Virtual laboratory simulation
* AI tutoring
* Behavioral analytics
* Misconception detection
* Adaptive learning
* Experiment-based learning
* Learning assessment

The long-term vision of the project is to create a complete collaborative virtual laboratory that supports both individual and group-based learning experiences.

---

# 2. Current System Architecture

The project currently consists of two separate repositories.

## Backend Repository

**AI-Guided-Virtual-Science-Lab-Service**

Technology stack:

* Node.js
* Express.js
* MongoDB
* Mongoose
* JWT Authentication
* Gemini API

---

## Mobile Application Repository

**Mobile-Application**

Technology stack:

* React Native
* Expo
* React Query

---

# 3. Current Scope of the System

The current implementation only supports Chemistry.

Although the application displays three subjects:

* Chemistry
* Physics
* Biology

Only Chemistry is fully implemented.

Physics and Biology currently display a "Coming Soon" message and have not yet been integrated into the backend.

The current system only supports the **Individual Laboratory** mode.

The **Collaborative Laboratory** mode described in the research proposal has not yet been developed.

---

# 4. System Workflow

The learning process follows a guided experiment model.

The complete experiment flow is:

```text
Select Subject

↓

Select Chemistry

↓

Select Practical

↓

Select Equipment

↓

Select Chemicals

↓

Enter Laboratory Workspace

↓

Perform Experiment

↓

Observe Reactions

↓

Receive AI Guidance

↓

Complete Experiment

↓

Generate Learning Assessment

↓

View Experiment Report
```

---

# 5. Completed Backend Features

---

## 5.1 Authentication System (Completed)

The authentication system has already been implemented.

Features include:

* JWT authentication
* Protected routes
* User authorization
* Rate limiting
* Helmet security
* CORS configuration

All laboratory-related APIs require authentication before they can be accessed.

---

## 5.2 Experiment Management System (Completed)

The experiment module stores all practical activities.

The system currently contains:

* 20 chemistry practical experiments

Each experiment includes:

* Experiment title
* Experiment description
* Required equipment
* Required chemicals
* Step-by-step procedure
* Expected observations

Example:

**Experiment: Neutralization of HCl and NaOH**

Required equipment:

* Beaker
* Burette
* pH meter
* Conical flask

Required chemicals:

* Hydrochloric acid
* Sodium hydroxide
* Phenolphthalein

Procedure:

1. Prepare the equipment.
2. Add hydrochloric acid.
3. Add phenolphthalein.
4. Slowly add sodium hydroxide.
5. Observe the color change.
6. Measure the pH.

---

## 5.3 Guided Experiment Flow (Completed)

The system uses a state-based learning model.

Students cannot skip stages.

The experiment progresses through the following phases:

```text
Equipment Selection

↓

Chemical Selection

↓

Procedure Execution

↓

Experiment Completion
```

Each phase is validated by the server.

---

### Equipment Selection

Students must select the required laboratory equipment.

The backend compares the student's selection with the experiment requirements.

The system evaluates:

* Correct equipment
* Missing equipment
* Unnecessary equipment

The student cannot proceed until the equipment selection is complete.

---

### Chemical Selection

Students must select the chemicals required for the experiment.

The backend validates the selected chemicals before allowing the student to enter the laboratory workspace.

---

## 5.4 Interactive Laboratory Workspace (Completed)

The laboratory workspace has already been implemented.

Students can interact with laboratory equipment through a drag-and-drop interface.

Available equipment includes:

* Beaker
* Flask
* Burette
* Test tube
* Burner
* Thermometer
* Pipette
* Dropper
* Stirrer
* Balance
* pH meter

Students can:

* Drag equipment
* Add chemicals
* Pour liquids
* Heat substances
* Stir solutions
* Measure pH
* Measure temperature

---

## 5.5 Live Bench System (Completed)

The laboratory uses a freeform workspace called the Live Bench.

Every laboratory object contains its own state.

The system tracks:

* Container contents
* Chemical mixtures
* Heating status
* Temperature
* Chemical quantities

Example:

```text
Beaker

Contents:

HCl

Temperature:

25°C

Heating:

Off
```

After heating:

```text
Beaker

Contents:

HCl

Temperature:

80°C

Heating:

On
```

---

## 5.6 Reaction Engine (Completed)

The reaction engine is responsible for determining whether a chemical reaction occurs.

The system does not perform real computational chemistry simulations.

Instead, it uses a curated reaction database.

Current reaction database:

* 13 predefined reactions
* 32 chemicals

The reaction engine analyzes:

```text
Student mixes chemicals

↓

Reaction database lookup

↓

Matching reaction found?

↓

Yes

↓

Generate products

↓

Display balanced equation

↓

Display reaction type

↓

Display reaction conditions

↓

Display observable changes
```

---

### If a reaction exists:

Example:

```text
HCl + NaOH

↓

NaCl + H₂O

↓

Reaction Type:

Neutralization

↓

Observations:

Color change

Temperature increase

pH change
```

---

### If no reaction exists:

Example:

```text
Copper + Zinc

↓

No matching reaction

↓

Educational explanation generated
```

Instead of simply displaying an error, the system explains why the reaction cannot occur.

---

## 5.7 Laboratory Animation System (Completed)

The laboratory includes visual reaction effects.

Implemented animations include:

* Bubbling
* Steam
* Color transitions

These visual effects help students understand reaction behavior.

---

## 5.8 Probe System (Completed)

The laboratory includes measuring instruments.

The pH meter is implemented as a probe system.

When the pH meter overlaps a container, the system automatically measures the solution.

Example:

```text
pH meter placed inside beaker

↓

Measure solution

↓

Return pH value
```

---

## 5.9 Compound Builder (Completed)

The compound builder allows students to create compounds before using them in an experiment.

Instead of providing every compound directly, the system can ask students to construct compounds themselves.

Workflow:

```text
Display equation

↓

Provide chemical elements

↓

Student arranges the equation

↓

Student balances the equation

↓

Validate the answer

↓

Generate the compound
```

The system also tracks how many attempts were required.

---

## 5.10 Misconception Database (Completed)

The project currently contains:

* 15 predefined misconceptions

Each misconception contains:

* Misconception code
* Description
* Correction strategy

Example:

```text
Code:

MC001

Description:

Student believes every acid reacts with every substance.

Correction Strategy:

Explain reaction requirements.

Provide examples.

Recommend another experiment.
```

---

## 5.11 Behavioral Analysis Engine (Completed)

This is one of the most important features in the entire system.

Most educational systems evaluate only the final answer.

This system analyzes the student's behavior throughout the experiment.

The engine collects session telemetry, including:

* Error rate
* Hint requests
* Experiment completion time
* Procedure mistakes
* Compound builder attempts
* Incorrect actions

---

### Rule 1: Procedural confusion detection

```text
High error rate

↓

Procedural confusion detected
```

---

### Rule 2: Knowledge-gap detection

```text
Three or more hints requested

↓

Knowledge gap identified
```

---

### Rule 3: Rushed experiment detection

```text
Experiment completed in less than 10 seconds

↓

Student rushed through the activity
```

---

### Rule 4: Misconception detection

```text
Repeated incorrect actions

↓

Pattern matching

↓

Misconception identified

↓

Correction strategy generated
```

---

### Strength detection

The system also identifies positive learning behaviors.

Examples:

* Low error rate
* No hints requested
* First-attempt completion

---

## 5.12 AI Tutor (Completed)

The AI tutor is powered by Gemini.

However, the tutor is not designed as a traditional chatbot.

The AI never stores laboratory information.

Instead, every interaction sends fresh contextual information to Gemini.

The context includes:

* Current experiment
* Laboratory state
* Equipment state
* Chemical state
* Recent actions
* Conversation history
* Student questions

This prevents the AI from relying on incorrect memories.

---

### Reactive tutoring (Completed)

The student can ask questions.

Example:

```text
Student:

Why didn't the reaction occur?

↓

AI Tutor

↓

Analyze current laboratory state

↓

Generate an explanation
```

---

### Proactive tutoring (Completed)

The AI can also provide guidance automatically.

Example:

```text
Student turns on the burner.

↓

AI automatically responds:

Heating increases molecular kinetic energy.

Observe how the reaction rate changes.
```

---

### Safety monitoring (Completed)

The AI continuously monitors chemical interactions.

If incompatible chemicals are mixed, the AI immediately warns the student.

---

## 5.13 AI Feedback Generation (Completed)

At the end of the experiment, the system generates an AI-based feedback report.

The report includes:

* Strengths
* Weaknesses
* Misconceptions
* Improvement suggestions

If Gemini is unavailable, the system automatically switches to a rule-based fallback mechanism.

---

## 5.14 Learning Assessment (Completed)

The system generates two different evaluations.

### Quantitative assessment

```text
Score:

85/100
```

---

### Qualitative assessment

```text
Understanding Level:

Advanced
```

Possible levels:

* Advanced
* Developing
* Foundational

---

## 5.15 Analytics API (Completed)

Analytics endpoints have already been implemented.

The system can generate:

* User analytics
* Session analytics
* Experiment statistics
* Learning performance data

---

# 6. Mobile Application Features (Completed)

Implemented mobile screens:

* Authentication
* Onboarding
* Subject selection
* Chemistry practical selection
* Equipment selection
* Chemical selection
* Laboratory workspace
* Compound builder
* AI tutor
* Session report

---

## React hooks already implemented

* use-lab-session
* use-lab-run
* use-lab-workspace
* use-lab-tutor

These hooks communicate with the backend through React Query.

---

# 7. Features That Have Not Been Built Yet

---

## 7.1 Collaborative Laboratory Mode (Not Built)

Planned architecture:

```text
Student A

↓

Shared Laboratory

↑

Student B

↑

Student C

↑

Student D
```

---

### Real-time synchronization (Not Built)

Planned technologies:

* WebSockets
* Redis

Every laboratory action should be synchronized.

Example:

```text
Student A adds HCl.

↓

Broadcast event.

↓

All participants receive the update.

↓

All students see the same laboratory state.
```

---

### Laboratory roles (Not Built)

Planned roles:

* Lab Leader
* Experimenter
* Observer
* Recorder

Each student should have different responsibilities.

---

### Team communication (Not Built)

Planned features:

* Group chat
* Shared whiteboard
* Shared notes

---

### Session replay (Not Built)

Planned functionality:

```text
00:00 Equipment selected

00:30 HCl added

01:00 Heating started

01:45 pH measured

02:30 Experiment completed
```

Students and teachers should be able to replay the entire experiment.

---

## 7.2 Teacher Dashboard (Not Built)

Planned features:

* Student progress
* Common misconceptions
* Experiment completion statistics
* Learning analytics
* Class performance reports

---

## 7.3 Gamification System (Not Built)

Planned features:

* Achievement badges
* Rewards
* Experience points
* Progress tracking
* Leaderboards

---

## 7.4 Automatic Laboratory Report Generation (Not Built)

Planned exports:

* PDF reports
* Word reports

Generated reports should include:

* Student information
* Experiment details
* Results
* Observations
* AI feedback
* Learning assessment

---

## 7.5 Biology Laboratory (Not Built)

Future implementation:

* Biology experiments
* Biology reaction simulations
* Biology learning modules

---

## 7.6 Physics Laboratory (Not Built)

Future implementation:

* Physics experiments
* Physics simulations
* Physics learning modules

---

# 8. Research Contribution

The main research contribution of this project is not the virtual laboratory itself.

The most important contribution is the combination of:

* AI-guided tutoring
* Student behavior analysis
* Misconception detection
* Adaptive feedback generation

Most virtual laboratories only evaluate whether an answer is correct.

This system evaluates how students learn.

The system continuously observes student behavior, identifies learning difficulties, detects misconceptions, provides contextual guidance, and generates personalized feedback.

This transforms the laboratory from a simple simulation into an intelligent learning environment.

---

# 9. Final System Summary

The AI-Guided Virtual Science Laboratory is currently a fully functional, AI-assisted, single-player virtual chemistry laboratory for Grade 10 and Grade 11 students.

Implemented features include:

* Authentication
* Guided experiments
* Equipment selection
* Chemical selection
* Interactive laboratory workspace
* Reaction engine
* Compound builder
* AI tutor
* Misconception detection
* Behavioral analysis
* Adaptive feedback
* Learning assessment
* Analytics

Future development will focus on:

* Real-time collaborative laboratories
* WebSocket synchronization
* Teacher dashboards
* Gamification
* Session replay
* Automatic report generation
* Physics laboratories
* Biology laboratories

The ultimate goal is to transform traditional science education into an intelligent, interactive, AI-powered collaborative learning experience.
