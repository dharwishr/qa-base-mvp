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



now i want to build a system that analyzed test cases can be run multiple times, but the problem is i dont want to run this as a browser-use task or ai assisted. which will cost more token. instead i want to run each step as a script or playwiright scirpt with live screenshots and each step result
how should i do this? 
keep that in mind that i want to create a auto heal system on top of this test run without ai that if the test run ffails in a step i want to cerate a system that can heal the issue and continue the test run


now i want to integrate live browser to frontend while runnig test case analysis and test case running
- i think both test case analysis as well as test case running is using cdp protocol to control browser (even bdp possible for playwirght as well if user choose playwright in test case run)
- so create a python based browser orchestrator that creates isolated browser instance inside a contianer and shares internal cdp url to backend test case analysis and test case running
- this browser orchestrator should be able to create multiple isolated browser instances and share cdp urls to backend test case analysis and test case running
- i think isolcated browsers instance can be run inside a custom docker cotainer which is pre configured with all required dependencies and browser
- to show user live browser in frontend, i think we can use novnc or search for simialr kinda technology


is live browser viewrs showed in screenshot area in frontend? for test case analysis and test case running

live browser is not correclty showing in frontend
- wait for browser to be ready
- wait for browser to be ready in the frontend as well
- then run the test case analysis
- maybe give users to show headless and non headless mode (headless mode will only show screenshots, non headless mode will show live browser)
- make headless mode default and no need to wait load browser in frontend
- non headless mode should show live browser in frontend and wait for browser to be ready then execute steps
- also make sure that each run is isolated and not reusing same browser instance, after test case analysis and test case running is completed, that unique brower contianer should be removed



even selected live mode in test case analysis, live browser is not showing.
in test case run, live browser is throwing this error Request URL
https://cdn.jsdelivr.net/npm/@nicholashaynes/novnc@1.4.0/lib/rfb.js
Request Method
GET
Status Code
404 Not Found
Remote Address
[2a04:4e42:400::485]:443
Referrer Policy
strict-origin-when-cro

