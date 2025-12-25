now create a qa browser automation ui
- login page (create a basic login page with hardcoded login email and password and show its as a example in the page as well)
- dashboard page with left side navigation and right side content
- left side navigation should be small like while normal shows logos but when user hover on it it should show logo + name of the module
- follow shadcn ui for the ui


_______________


i want to add a module to the the application called test case geenration 
- Module name: Test Cases Generation
- Module objective: Users can generate test cases in differnt manner
    - Document based test case generation : where users can upload multple documents related to the applciation and based on the documents it will generate test cases
    - Website url scouting based test case generation : where users can provide website url and based on the website it will generate test cases
- also after user selcting either of the above options it should redirect to the next page where user can select the test case type like: Validation Test Cases, Functionality Test Cases, Performance Test Cases etc. it should show like a cards with appropriate icons and description
- after user selecting the test case type, user will go to next page that shows processing the test case generation and aftrer some secconds show some dummy test cases


fix all the naviagtion issues in the pages especially when test case geenration module is selected no navbar is therer

______

i want to build a new module called test case analysis that after test cases are geenrate, users can start a test case analysis
reffer the image and build the ui


in test case analaysis steps should be added one by one as api reponse hits but for the time being mimick the steps as dummy data with inceasing each steps one by one


create a text multiline text input above the steps list, which will act as a entry point to generate test steps, there should be a button right to this input box to start the test case analysis, further it will generate steps one by one



i want to build a backend for ai based qa automation tool
- use python fastapi
- base package we are using is browser-use wihcb is already in the project, use that project do not download it from interner
- create a env for this project with these requirements
- backend code should be in backend folder
- also add sqlalchemy with sqlite database and albemic migrations (only setup it now, no need to add any models or migrations or tables)



now using browser-use i want to create a test case analysis module
- user can innput a qa task as a prompt 
- using that prompt i want to create a small plan using any llm 
- the give that plan to browser-use to generate steps
- borwser use has step  and actions inside steps model, using that i want to update the db with each step contents
- also each step should have a all data from browser us including goal thinking etc..
- in frontend i have create a page test analysis and in that i have added a text input box and a button to start the test case analysis, use that input -  create a plan - show the plan to user in frontend - after user approval start the test case analysis - add steps one by one to the db also show the steps in frontend


    go to google maps, search for restaurants near me, verify that there exists a restaurant with a rating greater than 4.7. if not, fail the test case