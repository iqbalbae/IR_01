document.addEventListener('DOMContentLoaded', () => {
  const mf = document.getElementById('math-input');
  const btn = document.getElementById('breakdown-btn');
  const feedback = document.getElementById('feedback');

  function showFeedback(message, type) {
    feedback.textContent = message;
    feedback.className = `feedback ${type}`;
    setTimeout(() => {
      feedback.textContent = '';
      feedback.className = 'feedback';
    }, 4000);
  }

  btn.addEventListener('click', async () => {
    try {
      // Get the value in an ascii-math or raw format that math.js could parse
      // MathLive provides 'math-json' or 'ascii-math'. Sometimes math.js is better with plain string.
      // 'ascii-math' usually looks like (x+y)/2 which mathjs understands well.
      let expression = mf.getValue('ascii-math');
      
      // If ascii-math is empty, the user hasn't typed anything
      if (!expression || expression.trim() === '') {
        showFeedback('Please enter an expression first.', 'error');
        return;
      }

      // Cleanup some Mathlive ascii math formats if necessary for Math.js
      // e.g., Mathlive uses '*' for multiplication implicitly sometimes, but explicitly `*` or `cdot`.
      expression = expression.replace(/cdot/g, '*');

      const node = math.parse(expression);
      
      let tempCounter = 1;
      const tacInstructions = [];

      const varLevels = {}; // variable -> execution level

      function generateTAC(n) {
        if (n.isSymbolNode) {
          varLevels[n.name] = 0; // Base variables are level 0
          return n.name;
        } else if (n.isConstantNode) {
          const val = n.value.toString();
          varLevels[val] = 0; // Constants are level 0
          return val;
        } else if (n.isOperatorNode) {
          let instructionStr = "";
          let deps = [];
          const tempVar = `t${tempCounter++}`;
          let level = 1;

          if (n.args.length === 1) { // Unary operator (like -x)
            const arg = generateTAC(n.args[0]);
            instructionStr = `${tempVar} = ${n.op}${arg}`;
            deps = [arg];
          } else if (n.args.length === 2) { // Binary operator
            const left = generateTAC(n.args[0]);
            const right = generateTAC(n.args[1]);
            instructionStr = `${tempVar} = ${left} ${n.op} ${right}`;
            deps = [left, right];
          }

          level = Math.max(...deps.map(d => varLevels[d] || 0)) + 1;
          varLevels[tempVar] = level;

          tacInstructions.push({ tempVar, instruction: instructionStr, level, deps, op: n.op });
          return tempVar;
        } else if (n.isParenthesisNode) {
          return generateTAC(n.content);
        } else if (n.isFunctionNode) {
          const args = n.args.map(arg => generateTAC(arg));
          const tempVar = `t${tempCounter++}`;
          const instructionStr = `${tempVar} = ${n.fn.name}(${args.join(', ')})`;
          const deps = args;
          const level = Math.max(...deps.map(d => varLevels[d] || 0)) + 1;
          varLevels[tempVar] = level;

          tacInstructions.push({ tempVar, instruction: instructionStr, level, deps, op: n.fn.name });
          return tempVar;
        }
        // Fallback for unhandled node types
        return n.toString();
      }

      const finalResult = generateTAC(node);
      
      // Extract unique variables and operations
      const variables = new Set();
      const operations = new Set();

      node.traverse(function (n, path, parent) {
        if (n.isSymbolNode) {
          // If the symbol is the name of a function, it's an operation, not a variable.
          if (parent && parent.isFunctionNode && path === 'fn') {
            // It's a function name
          } else if (n.name !== 'pi' && n.name !== 'e') {
            variables.add(n.name);
          }
        } else if (n.isOperatorNode) {
          operations.add(n.op);
        } else if (n.isFunctionNode) {
          if (n.fn && n.fn.name) {
            operations.add(n.fn.name);
          }
        }
      });
      const variableList = variables.size > 0 ? Array.from(variables).join(', ') : 'None';
      const operationList = operations.size > 0 ? Array.from(operations).join(', ') : 'None';

      // Helper function to read file asynchronously
      function readFile(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = (e) => reject(e);
          reader.readAsText(file);
        });
      }

      let dataResults = '';
      const fileInput = document.getElementById('data-file');
      
      if (fileInput.files.length > 0) {
        try {
          const text = await readFile(fileInput.files[0]);
          const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
          
          if (lines.length > 0) {
            const headers = lines[0].split(',').map(h => h.trim());
            dataResults = '\n\nData File Calculations\n---------------------------\n';
            dataResults += 'Row\t' + headers.join('\t') + '\t|\tResult\n';
            dataResults += '----------------------------------------------------------\n';
            
            // Evaluate for each row
            for (let i = 1; i < lines.length; i++) {
              const values = lines[i].split(',').map(v => v.trim());
              const scope = {};
              let rowValid = true;

              for (let j = 0; j < headers.length; j++) {
                if (values[j] === undefined || isNaN(parseFloat(values[j]))) {
                  rowValid = false;
                  break;
                }
                scope[headers[j]] = parseFloat(values[j]);
              }

              if (rowValid) {
                try {
                  const result = node.evaluate(scope);
                  dataResults += `${i}\t${values.join('\t')}\t|\t${result}\n`;
                } catch (e) {
                  dataResults += `${i}\t${values.join('\t')}\t|\tError: ${e.message}\n`;
                }
              } else {
                dataResults += `${i}\t${values.join('\t')}\t|\tInvalid Row Data\n`;
              }
            }
          }
        } catch (err) {
          dataResults = '\n\nError reading or processing data file: ' + err.message;
        }
      }

      // Assign IDs to TAC instructions
      tacInstructions.forEach((tac, index) => {
        tac.id = index + 1;
      });

      // Generate Parallel Schedule
      const scheduleMap = {};
      let maxLevel = 0;
      tacInstructions.forEach(tac => {
        if (!scheduleMap[tac.level]) scheduleMap[tac.level] = [];
        scheduleMap[tac.level].push(tac);
        if (tac.level > maxLevel) maxLevel = tac.level;
      });

      let scheduleText = `\nParallel Execution Schedule:\nBatch\t|\tID\t|\tEquation\n----------------------------------------------------------\n`;
      let opSummaryText = `\nParallel Execution Operation Summary:\nBatch\t|\tOperations Needed\n----------------------------------------------------------\n`;
      
      for (let i = 1; i <= maxLevel; i++) {
        if (scheduleMap[i]) {
          const opCounts = {};
          scheduleMap[i].forEach(tac => {
            scheduleText += `${i}\t|\t${tac.id}\t|\t${tac.instruction}\n`;
            if (tac.op) {
              opCounts[tac.op] = (opCounts[tac.op] || 0) + 1;
            }
          });
          const opStr = Object.entries(opCounts).map(([op, count]) => `${count}x '${op}'`).join(', ');
          if (opStr) {
            opSummaryText += `${i}\t|\t${opStr}\n`;
          }
        }
      }
      scheduleText += opSummaryText;

      // Generate Mermaid DAG
      let mermaidText = `\nDirected Acyclic Graph (Mermaid Syntax):\n\`\`\`mermaid\ngraph TD\n`;
      tacInstructions.forEach(tac => {
        tac.deps.forEach(dep => {
          mermaidText += `  ${dep} --> ${tac.tempVar}\n`;
        });
      });
      mermaidText += `  ${finalResult} --> Result\n\`\`\`\n`;

      // Generate TAC Table
      let tacTable = `ID\t|\tEquation\n----------------------------------------------------------\n`;
      if (tacInstructions.length > 0) {
        tacTable += tacInstructions.map(tac => `${tac.id}\t|\t${tac.instruction}`).join('\n');
        tacTable += `\n${tacInstructions.length + 1}\t|\tResult = ${finalResult}`;
      } else {
        tacTable += `1\t|\tResult = ${finalResult}`;
      }

      // The output text representation
      let report = `Three-Address Code Breakdown
---------------------------
Original Expression: ${expression}

Variables Found: ${variableList}
Operations Found: ${operationList}

Step-by-step Three-Address Code:
${tacTable}
---------------------------${scheduleText}${mermaidText}
Parsed successfully using MathLive and Math.js.`;

      report += dataResults;
      report += '\n';

      const response = await window.electronAPI.saveBreakdown(report);
      
      if (response.success) {
        showFeedback(response.message, 'success');
      } else {
        showFeedback(response.message, 'error');
      }

    } catch (err) {
      console.error(err);
      showFeedback('Could not parse expression. Ensure it is a valid mathematical format.', 'error');
    }
  });

  // Helper to extract current variables
  function extractCurrentVariables() {
    let expression = mf.getValue('ascii-math');
    if (!expression || expression.trim() === '') return [];
    expression = expression.replace(/cdot/g, '*');
    try {
      const node = math.parse(expression);
      const variables = new Set();
      node.traverse(function (n, path, parent) {
        if (n.isSymbolNode) {
          if (parent && parent.isFunctionNode && path === 'fn') {
            // Function name
          } else if (n.name !== 'pi' && n.name !== 'e') {
            variables.add(n.name);
          }
        }
      });
      return Array.from(variables);
    } catch (err) {
      return [];
    }
  }

  // Handle CSV template download
  document.getElementById('download-csv-btn').addEventListener('click', () => {
    const vars = extractCurrentVariables();
    if (vars.length === 0) {
      showFeedback('No variables found in equation to create template.', 'error');
      return;
    }
    const csvContent = vars.join(',') + '\n' + vars.map((_, i) => i + 1).join(',');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Handle TXT template download
  document.getElementById('download-txt-btn').addEventListener('click', () => {
    const vars = extractCurrentVariables();
    if (vars.length === 0) {
      showFeedback('No variables found in equation to create template.', 'error');
      return;
    }
    const txtContent = vars.join(',') + '\n' + vars.map((_, i) => i + 1).join(',');
    const blob = new Blob([txtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template.txt';
    a.click();
    URL.revokeObjectURL(url);
  });
});
