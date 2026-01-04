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


in act mode browser use gets halucinated or get lot becasue browser use desinged to run a whole task not a single action, can you fix that ? (you can make changes in browser use but make sure that its treated seperatly for this scenario)
also using plan mode second time is geeting issues, can you fix that ? like using browser- use context to get more details + given text chat to get more details using both create a plan (you can make changes in browser use but make sure that its treated seperatly for this scenario)
also when test analysis doing something like runing a action or planing something and if use put more chat/task in between then it should wait till the previous action or plan is completed. show your that its waiting, after previosu action completed then run the given action.


<!-- re use test case analysis new page in previosu test case analysis, -->
<!-- re initialte browser session on that with stesp till end to be emulated -->
also check if possible to store a browser ssesion like a snapshot aht we can reuse it when user want to go to previous analysis sessions\
edit input variables inside the test case analaysis steps

steps only view as per picture

analsysis step ui enhanc


record and play back from vnc/cdp



re use test case analysis new page in previosu test case analysis:
goal is to make use of older test case analysis
when user clicks on older test case analsysis i want to show the test case analysis page as same as new test case analsysis page (including steps, previous chats etc)
for live browser there should be a option in the chat input section as blocking that re initiate the session
when user clicks that a browser session start (new or previous one) and emulates all the actions in the steps to the browser
and the browser session should be visible like new test case analaysis page
if there is 10 steps and if it got broken / failed in 7th step, ask user that create a new test case analysis with till 7th step or undo till in the current test case analysis page and do accordingly 
implememt e2e frontend and backend for this


    





now i want to introduce live browser sesion user interaction recordiong
- in current system, live browser is shown in analaysis page. 
- i want to restrict user interation with live browser during analsysis
- add a button on top of live browser says take control and record 
- when user click, the test analysis need to go to record mode 
- and user can interact with live browser
- i want to record users actions and save it as a step + action inside the test case analysis page
- every actions should be recorded and saved, when user clicks stop recording, the record mode should be stopped
- and the recorded actions should be visible in the test case analysis page which can also be runnable like ai geenrated steps



i want to create a llm benchmark mode for test case analysis as a seperate module that user can pick up to 3 models and run the benchmark.
user will have single chat interface to chat with all the models and compare the results. 
live browser view for all the models as well
do complete frontend and backend implementation for this
make sure that its a seperate module in leftside navigation with entire differnt page
i think we have already implemented celery task for test case analysis, so create each llm model as a celery task and run them in parallel



now i want to build a undo buttom feature in test case analysis
the user flow wanted will be like this:
user will give prompt in chat interface
- steps are generated and run
lets say it generated 10 steps and user want to undo the last 5 steps
- each step will have a undo till here button that when clicked it will undo the last 5 steps by asking user to confirm
- but the problem is there is no way to simplty undo all steps in rightside browser view (think and check if there are any way to do it)
- so my proposed way is that if user undo till 5 stpes we will emulate all the steps from the beigining to 5th step using the json info of eachstep action in right browser
- each session will have browser with cdp url so if undo happend, we will use that cdp url to emulatate the steps begining till the 5th step using playwright runner or cdp runner which ever is the best
- then user can continue from there
- make sure that in confirmation message this also mentioned in undo procedeure



- user give a prompt in plan mode: 
"Goto https://cigclouds.com/demoit/login.php and login as demo and demo123. Go to main menu Create. Click on Purchase order sub menu item. Set the value Purchase Ledger as 'Purchase Account Credit'. Set the Select Party as 'Test Customer2'. Set Reference number as 1234. Set Narration Text as 'My test narration'. Set Product as 'Copper1'. Set Qty as 10. Set Rate as 11. Click on 'Create Purchase Order' button."
- Generates a plan
- Approves the plan
- App will generta and run test case steps 
- App competes the run part for previous test case steps

Now if a user want to do another plan mode, app is repeating already done steps. instead app should generate a  new plan using the context of browser-use and given prompt (no need to repeat previous steps, no need to take prevous step context as well)



now i want to create test script from the test case analaysis steps
- user will click on a button that called generate test script
- after click that the generated steps inside the test case analaysis will be converted to test script
- user can execute the test script in the test run
- all the steps should be under same test case 



Goto https://cigclouds.com/demoit/login.php and login as demo and demo123. Go to main menu Create. Click on Purchase order sub menu item. Set the value Purchase Ledger as 'Purchase Account Credit'. Set the Select Party as 'Test Customer2'. Set Reference number as 1234. Set Narration Text as 'My test narration'. Set Product as 'Copper1'. Set Qty as 10. Set Rate as 11. Click on 'Create Purchase Order' button.



____________________________________________________________________________________________________


add a option to edit the plan that generated by ai
make sure that whole plan is which is generated by ai is shown in the chat interface, an user can edit the plan and generate a new plan
user can edit steps inside that plan and remove and add steps as well, also user can add text based prompts inside the plan as well
make sure that you create a intutive ui for this


In test case analysis page, i want to add a status symbol of the whole test case analysis.
it should show a color icon + text of the status of the test case analysis.


pause button in test case analysis page needs a spinner as well as verification that the test case analysis is paused.
current implement is that user clicks on pause button and nothing happens and after some time the test case analysis is paused.
so it should indicate that the test case analysis is paused and show a spinner as well till the test case analysis is paused.


initially test case run / test case runner / playwright runner desinged to use cdp to communicate with browser
but different browser are not supported by cdp
so now i want to use playwright server to communicate with browser in test runner
this is not related to test case analysis and its cdp setup
user starts a test run and it should spawn a contianer specific for that browser which includes the browser and playwright server
then it should connect to playwright server and start running the test case

check test-browser/borwsers folder to see docker file for each browser and check chnages done so far is wokring properly

Test Runner Module (we already have this in scripts page this is to enhance it)

things users can select before starting test run
- user can select which borwser (firefox, chrome, edge, safari if playwright supports)
- pick which resolution (from standerd resolutions list maybe common 3 items)
- toggle should screenshots for each step or not (enable by default)
- toggle screen recording whole test run or not (enable by default)
- toggle record api/network calls or not (enable or disable by user) disabled by default
- toggle messuare network/api/asset loading time (enable by default)

things must follow for test run

- strictly use playwright for test run and create a test run orchestrator that will spin up unique playwright docker container for each test run. 
- logs for each test run (console logs)
- each step duration and whole test case duration need to be calculated

implement e2e backend for test run and update the current ui to accomadate this things

in future:
global proxy geo location support
maybe add feature to add server speicify how many parrallel test runs to be done

use current docker contianer with vnc support so that user can pause test run debug and maybe continue
