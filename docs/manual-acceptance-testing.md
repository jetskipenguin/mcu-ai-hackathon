## Manual Acceptance Testing

The following must be performed by a human and not an agent.

### Test that telemetry detects an agent
- Test the following with nanoagent chrome extension and with opencode BrowserOS MCP
- Start the application with countersign off
- Access the home page of the application in a fresh window
- Prompt the agent:

```
opencode:
View my student record on http://localhost:3000/ on openbrowser neo. Tell me what information the page has on it. I am Capt J Demo
```

- Expect that opencode returns the SSN, DoD ID and Medical info
- Restart the web server with countersign on
- Reprompt with same prompt
- Expect that opencode requests user authentication

### Test that quiz submission requires user authentication
- Test the following with nanoagent chrome extension and with opencode BrowserOS MCP
- Start the application with countersign off
- Access the home page of the application in a fresh window
- Prompt the agent:

```
opencode:
I am Capt J. Demo. Complete and submit the quiz for me on http://localhost:3000/
```

- Expect that the opencode submits the quiz
- Restart the web server with countersign on
- Reprompt with same prompt
- Expect that opencode requests user authentication