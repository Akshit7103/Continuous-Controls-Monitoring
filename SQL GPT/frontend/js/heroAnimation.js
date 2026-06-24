export class HeroAnimation {
    constructor() {
        this.examples = [
            {
                query: "Fetch me the top 5 highest value policies",
                sql: "SELECT policy_id, value, date\nFROM moneyback_policies\nORDER BY value DESC LIMIT 5;"
            },
            {
                query: "How many employees are in the IT department?",
                sql: "SELECT count(*)\nFROM employees\nWHERE department = 'IT';"
            },
            {
                query: "Show me high risk transactions from yesterday",
                sql: "SELECT * FROM aml_risk_categorization\nWHERE risk_level = 'High'\nAND date = CURRENT_DATE - 1;"
            }
        ];
        
        this.currentIndex = 0;
        this.isTyping = false;
        
        // DOM Elements
        this.userMsg = document.getElementById('mockUserMsg');
        this.typewriter = document.getElementById('mockTypewriter');
        this.aiMsg = document.getElementById('mockAiMsg');
        this.thinking = document.getElementById('mockThinking');
        this.sqlOutput = document.getElementById('mockSql');
    }

    async init() {
        if (!this.userMsg) return;
        // Start loop
        this.runLoop();
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async typeText(text) {
        this.typewriter.textContent = '';
        this.isTyping = true;
        
        for (let i = 0; i < text.length; i++) {
            if (!this.isTyping) break;
            this.typewriter.textContent += text.charAt(i);
            await this.sleep(40); // typing speed
        }
        
        this.isTyping = false;
    }

    async runLoop() {
        while (true) {
            const example = this.examples[this.currentIndex];
            
            // 1. Reset states
            this.userMsg.style.transform = 'translateY(10px)';
            this.userMsg.style.opacity = '0';
            this.aiMsg.style.transform = 'translateY(10px)';
            this.aiMsg.style.opacity = '0';
            this.thinking.style.display = 'none';
            this.sqlOutput.style.display = 'none';
            this.typewriter.textContent = '';
            
            await this.sleep(500); // Wait before starting

            // 2. Show User Bubble and Type
            this.userMsg.style.opacity = '1';
            this.userMsg.style.transform = 'translateY(0)';
            await this.sleep(300);
            await this.typeText(example.query);
            await this.sleep(400);

            // 3. Show AI Bubble with Thinking Dots
            this.aiMsg.style.opacity = '1';
            this.aiMsg.style.transform = 'translateY(0)';
            this.thinking.style.display = 'flex';
            await this.sleep(1200); // "Thinking" time

            // 4. Show SQL Output
            this.thinking.style.display = 'none';
            this.sqlOutput.style.display = 'block';
            this.sqlOutput.innerHTML = example.sql.replace(/\n/g, '<br>');
            
            // 5. Hold view
            await this.sleep(4000); // Reading time

            // 6. Fade Out Both and Progress Loop
            this.userMsg.style.opacity = '0';
            this.aiMsg.style.opacity = '0';
            await this.sleep(600);

            this.currentIndex = (this.currentIndex + 1) % this.examples.length;
        }
    }
}
